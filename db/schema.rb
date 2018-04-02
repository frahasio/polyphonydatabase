# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# Note that this schema.rb definition is the authoritative source for your
# database schema. If you need to create the application database on another
# system, you should be using db:schema:load, not running all the migrations
# from scratch. The latter is a flawed and unsustainable approach (the more migrations
# you'll amass, the slower it'll run and the greater likelihood for issues).
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema.define(version: 20180402152125) do

  # These are extensions that must be enabled in order to support this database
  enable_extension "plpgsql"

  create_table "aliases", force: :cascade do |t|
    t.integer  "composer_id"
    t.integer  "anonym_id"
    t.datetime "created_at",  null: false
    t.datetime "updated_at",  null: false
    t.index ["anonym_id"], name: "index_aliases_on_anonym_id", using: :btree
    t.index ["composer_id"], name: "index_aliases_on_composer_id", using: :btree
  end

  create_table "anonyms", force: :cascade do |t|
    t.string   "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "attributions", force: :cascade do |t|
    t.integer  "inclusion_id"
    t.integer  "alias_id"
    t.integer  "composer_id"
    t.integer  "anonym_id"
    t.boolean  "incorrectly_attributed"
    t.datetime "created_at",             null: false
    t.datetime "updated_at",             null: false
    t.index ["alias_id"], name: "index_attributions_on_alias_id", using: :btree
    t.index ["anonym_id"], name: "index_attributions_on_anonym_id", using: :btree
    t.index ["composer_id"], name: "index_attributions_on_composer_id", using: :btree
    t.index ["inclusion_id"], name: "index_attributions_on_inclusion_id", using: :btree
  end

  create_table "clefs", force: :cascade do |t|
    t.string   "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "clefs_inclusions", force: :cascade do |t|
    t.integer  "clef_id"
    t.integer  "inclusion_id"
    t.boolean  "missing",        default: false, null: false
    t.boolean  "partial",        default: false, null: false
    t.datetime "created_at",                     null: false
    t.datetime "updated_at",                     null: false
    t.string   "transitions_to"
    t.index ["clef_id"], name: "index_clefs_inclusions_on_clef_id", using: :btree
    t.index ["inclusion_id"], name: "index_clefs_inclusions_on_inclusion_id", using: :btree
  end

  create_table "composers", force: :cascade do |t|
    t.string   "name"
    t.integer  "from_year"
    t.integer  "to_year"
    t.string   "from_year_annotation"
    t.string   "to_year_annotation"
    t.string   "birthplace_1"
    t.string   "birthplace_2"
    t.string   "deathplace_1"
    t.string   "deathplace_2"
    t.string   "image_url"
    t.datetime "created_at",           null: false
    t.datetime "updated_at",           null: false
  end

  create_table "composers_compositions", id: false, force: :cascade do |t|
    t.integer "composer_id",    null: false
    t.integer "composition_id", null: false
    t.index ["composer_id", "composition_id"], name: "index_composers_compositions_on_composer_id_and_composition_id", using: :btree
  end

  create_table "composers_unique_pieces", force: :cascade do |t|
    t.integer "composer_id"
    t.integer "unique_piece_id"
    t.index ["composer_id"], name: "index_composers_unique_pieces_on_composer_id", using: :btree
    t.index ["unique_piece_id"], name: "index_composers_unique_pieces_on_unique_piece_id", using: :btree
  end

  create_table "compositions", force: :cascade do |t|
    t.integer  "number_of_voices"
    t.integer  "group_id"
    t.integer  "title_id"
    t.datetime "created_at",       null: false
    t.datetime "updated_at",       null: false
    t.index ["group_id"], name: "index_compositions_on_group_id", using: :btree
    t.index ["number_of_voices", "title_id"], name: "index_compositions_on_number_of_voices_and_title_id", using: :btree
    t.index ["title_id"], name: "index_compositions_on_title_id", using: :btree
  end

  create_table "editions", force: :cascade do |t|
    t.string   "voicing"
    t.string   "editor_name"
    t.string   "file_url"
    t.datetime "created_at",                      null: false
    t.datetime "updated_at",                      null: false
    t.integer  "unique_piece_id"
    t.integer  "group_id"
    t.integer  "editor_id"
    t.boolean  "has_pdf",         default: false
    t.index ["editor_id"], name: "index_editions_on_editor_id", using: :btree
    t.index ["group_id"], name: "index_editions_on_group_id", using: :btree
    t.index ["unique_piece_id"], name: "index_editions_on_unique_piece_id", using: :btree
  end

  create_table "editors", force: :cascade do |t|
    t.string   "name"
    t.date     "date_of_birth"
    t.datetime "created_at",    null: false
    t.datetime "updated_at",    null: false
  end

  create_table "feasts_unique_pieces", force: :cascade do |t|
    t.string  "feast_code"
    t.integer "unique_piece_id"
    t.index ["unique_piece_id"], name: "index_feasts_unique_pieces_on_unique_piece_id", using: :btree
  end

  create_table "functions", force: :cascade do |t|
    t.string   "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "functions_titles", id: false, force: :cascade do |t|
    t.integer "function_id", null: false
    t.integer "title_id",    null: false
    t.index ["function_id", "title_id"], name: "index_functions_titles_on_function_id_and_title_id", using: :btree
  end

  create_table "groups", force: :cascade do |t|
    t.string   "display_title"
    t.datetime "created_at",    null: false
    t.datetime "updated_at",    null: false
  end

  create_table "inclusions", force: :cascade do |t|
    t.integer  "source_id"
    t.integer  "piece_id"
    t.string   "notes"
    t.integer  "order",           null: false
    t.datetime "created_at",      null: false
    t.datetime "updated_at",      null: false
    t.integer  "unique_piece_id"
    t.string   "public_notes"
    t.integer  "position"
    t.integer  "composition_id"
    t.index ["composition_id"], name: "index_inclusions_on_composition_id", using: :btree
    t.index ["piece_id"], name: "index_inclusions_on_piece_id", using: :btree
    t.index ["source_id"], name: "index_inclusions_on_source_id", using: :btree
  end

  create_table "performers", force: :cascade do |t|
    t.string   "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "pieces", force: :cascade do |t|
    t.text     "title",      null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "publishers", force: :cascade do |t|
    t.string   "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "publishers_sources", id: false, force: :cascade do |t|
    t.integer "publisher_id", null: false
    t.integer "source_id",    null: false
    t.index ["publisher_id"], name: "index_publishers_sources_on_publisher_id", using: :btree
    t.index ["source_id"], name: "index_publishers_sources_on_source_id", using: :btree
  end

  create_table "recordings", force: :cascade do |t|
    t.string   "performer_name"
    t.string   "file_url"
    t.datetime "created_at",      null: false
    t.datetime "updated_at",      null: false
    t.integer  "unique_piece_id"
    t.integer  "group_id"
    t.integer  "performer_id"
    t.index ["group_id"], name: "index_recordings_on_group_id", using: :btree
    t.index ["performer_id"], name: "index_recordings_on_performer_id", using: :btree
    t.index ["unique_piece_id"], name: "index_recordings_on_unique_piece_id", using: :btree
  end

  create_table "scribes", force: :cascade do |t|
    t.string   "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "scribes_sources", id: false, force: :cascade do |t|
    t.integer "scribe_id", null: false
    t.integer "source_id", null: false
    t.index ["scribe_id"], name: "index_scribes_sources_on_scribe_id", using: :btree
    t.index ["source_id"], name: "index_scribes_sources_on_source_id", using: :btree
  end

  create_table "sources", force: :cascade do |t|
    t.string   "code",                                   null: false
    t.text     "title"
    t.string   "type"
    t.string   "format"
    t.string   "publisher_or_scribe"
    t.string   "town"
    t.string   "rism_link"
    t.string   "url"
    t.boolean  "catalogued",             default: false, null: false
    t.datetime "created_at",                             null: false
    t.datetime "updated_at",                             null: false
    t.integer  "from_year"
    t.integer  "to_year"
    t.string   "from_year_annotation"
    t.string   "to_year_annotation"
    t.string   "dates"
    t.string   "location_and_pubscribe"
  end

  create_table "titles", force: :cascade do |t|
    t.string   "text"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["text"], name: "index_titles_on_text", unique: true, using: :btree
  end

  create_table "unique_pieces", force: :cascade do |t|
    t.text     "title"
    t.string   "composer_list"
    t.integer  "minimum_voices"
    t.text     "feasts"
    t.datetime "created_at",                     null: false
    t.datetime "updated_at",                     null: false
    t.boolean  "has_edition",    default: false
    t.boolean  "has_recording",  default: false
  end

  create_table "users", force: :cascade do |t|
    t.string   "username"
    t.string   "password"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

end
