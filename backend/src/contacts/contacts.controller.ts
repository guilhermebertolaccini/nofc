import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { RenameContactDto } from "./dto/rename-contact.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Role } from "@prisma/client";

@Controller("contacts")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  create(@Body() createContactDto: CreateContactDto) {
    return this.contactsService.create(createContactDto);
  }

  @Get()
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  findAll(
    @Query("search") search?: string,
    @Query("segment") segment?: string
  ) {
    return this.contactsService.findAll(
      search,
      segment ? parseInt(segment) : undefined
    );
  }

  @Get("by-phone/:phone")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  findByPhone(@Param("phone") phone: string) {
    return this.contactsService.findByPhone(phone);
  }

  /**
   * GET /contacts/sync-old-groups/:instanceName?token=tatica-sync-2026
   * Job manual único — sincroniza nomes reais de grupos antigos via Evolution API.
   */
  @Public()
  @Get("sync-old-groups/:instanceName")
  syncOldGroups(
    @Param("instanceName") instanceName: string,
    @Query("token") token: string,
  ) {
    if (token !== "tatica-sync-2026") {
      throw new UnauthorizedException("Token inválido");
    }
    return this.contactsService.syncOldGroupNames(instanceName);
  }

  @Get(":id")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  findOne(@Param("id") id: string) {
    return this.contactsService.findOne(+id);
  }

  @Patch("by-phone/:phone")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  updateByPhone(
    @Param("phone") phone: string,
    @Body() updateContactDto: UpdateContactDto
  ) {
    return this.contactsService.updateByPhone(phone, updateContactDto);
  }

  /**
   * PATCH /contacts/rename/:phone
   * Renomeia manualmente o contato/grupo do Shared Inbox.
   * Disponível para todos os papéis com acesso ao atendimento.
   */
  @Patch("rename/:phone")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  rename(
    @Param("phone") phone: string,
    @Body() dto: RenameContactDto
  ) {
    return this.contactsService.rename(phone, dto);
  }

  /**
   * PATCH /contacts/toggle-pin/:phone
   * Fixa ou desfixa conversa no topo da sidebar (Shared Inbox).
   */
  @Patch("toggle-pin/:phone")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  togglePin(@Param("phone") phone: string) {
    return this.contactsService.togglePinByPhone(phone);
  }

  @Patch(":id")
  @Roles(Role.admin, Role.supervisor, Role.operator, Role.digital)
  update(@Param("id") id: string, @Body() updateContactDto: UpdateContactDto) {
    return this.contactsService.update(+id, updateContactDto);
  }

  @Delete(":id")
  @Roles(Role.admin, Role.supervisor)
  remove(@Param("id") id: string) {
    return this.contactsService.remove(+id);
  }
}
