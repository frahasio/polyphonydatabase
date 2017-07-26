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

ActiveRecord::Schema.define(version: 20170726133540) do

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

  create_table "editions", force: :cascade do |t|
    t.string   "voicing"
    t.string   "editor"
    t.string   "file_url"
    t.datetime "created_at",      null: false
    t.datetime "updated_at",      null: false
    t.integer  "unique_piece_id"
    t.index ["unique_piece_id"], name: "index_editions_on_unique_piece_id", using: :btree
  end

  create_table "inclusions", force: :cascade do |t|
    t.integer  "source_id"
    t.integer  "piece_id"
    t.string   "notes"
    t.integer  "order",      null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["piece_id"], name: "index_inclusions_on_piece_id", using: :btree
    t.index ["source_id"], name: "index_inclusions_on_source_id", using: :btree
  end

  create_table "pieces", force: :cascade do |t|
    t.text     "title",      null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "recordings", force: :cascade do |t|
    t.string   "performer"
    t.string   "file_url"
    t.datetime "created_at",      null: false
    t.datetime "updated_at",      null: false
    t.integer  "unique_piece_id"
    t.index ["unique_piece_id"], name: "index_recordings_on_unique_piece_id", using: :btree
  end

  create_table "sources", force: :cascade do |t|
    t.string   "code",                                 null: false
    t.text     "title"
    t.string   "type"
    t.string   "format"
    t.string   "publisher_or_scribe"
    t.string   "town"
    t.string   "rism_link"
    t.string   "url"
    t.boolean  "catalogued",           default: false, null: false
    t.datetime "created_at",                           null: false
    t.datetime "updated_at",                           null: false
    t.integer  "from_year"
    t.integer  "to_year"
    t.string   "from_year_annotation"
    t.string   "to_year_annotation"
  end

  create_table "unique_pieces", force: :cascade do |t|
    t.text     "title"
    t.string   "composers"
    t.integer  "minimum_voices"
    t.text     "feasts"
    t.datetime "created_at",     null: false
    t.datetime "updated_at",     null: false
  end

  create_table "users", force: :cascade do |t|
    t.string   "username"
    t.string   "password"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

end
